"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { upsertUserPermission, bulkGrantPermissions, bulkRevokePermissions } from "@/server/permissions";
import { ALL_PERMISSIONS, PERMISSION_BUNDLES } from "@/lib/permissions/constants";
import { Switch } from "@/components/ui/switch";
import { SearchIcon, ChevronDownIcon, CheckIcon, ShieldIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── All managed permissions ────────────────────────────────────────────────────
// Approval/checker keys (leave:approve, claim:check, etc.) are managed
// exclusively at /dashboard/admin/approvals, not here.

type PermEntry = { key: string; label: string };

const ALL_MANAGED: PermEntry[] = [...ALL_PERMISSIONS];

// ── Permission groups ─────────────────────────────────────────────────────────

type PermGroup = { id: string; label: string; perms: PermEntry[] };

// Map each key to a group id
const KEY_GROUP: Record<string, string> = {
  "quotation:read": "sales", "quotation:create": "sales", "quotation:update": "sales", "quotation:delete": "sales",
  "sales-order:read": "sales", "sales-order:create": "sales", "sales-order:update": "sales", "sales-order:delete": "sales",
  "customer-po:read": "sales", "customer-po:create": "sales", "customer-po:update": "sales", "customer-po:delete": "sales",
  "customer:read": "sales", "customer:create": "sales", "customer:update": "sales", "customer:delete": "sales",

  "purchase-requisition:read": "procurement", "purchase-requisition:create": "procurement",
  "purchase-requisition:update": "procurement", "purchase-requisition:delete": "procurement",
  "purchase-order:read": "procurement", "purchase-order:create": "procurement",
  "purchase-order:update": "procurement", "purchase-order:delete": "procurement",
  "goods-receipt:create": "procurement",
  "supplier:read": "procurement", "supplier:create": "procurement", "supplier:update": "procurement", "supplier:delete": "procurement",

  "delivery-order:read": "fulfillment", "delivery-order:create": "fulfillment",
  "delivery-order:update": "fulfillment", "delivery-order:delete": "fulfillment",
  "invoice:read": "fulfillment", "invoice:create": "fulfillment",
  "invoice:update": "fulfillment", "invoice:delete": "fulfillment",
  "account:read": "fulfillment", "account:create": "fulfillment",
  "account:update": "fulfillment", "account:delete": "fulfillment",

  "product:read": "products", "product:seed": "products",
  "product:update-price": "products", "product:upload-image": "products",

  "inventory:read": "inventory", "inventory:adjust": "inventory",
  "inventory:manage": "inventory", "inventory:request": "inventory",

  "leave:read:own": "hr", "leave:read:all": "hr", "leave:apply": "hr", "leave:manage": "hr",
  "claim:read:own": "hr", "claim:apply": "hr", "claim:manage": "hr",
  "payslip:read:own": "hr", "payslip:read:all": "hr", "payslip:create": "hr",
  "profile:read": "hr", "profile:update": "hr", "profile:read:all": "hr", "profile:update:all": "hr", "profile:delete:all": "hr",

  "member:read": "org", "member:invite": "org", "member:remove": "org",
  "department:read": "org", "department:create": "org", "department:delete": "org",
  "organization-profile:read": "org", "organization-profile:create": "org",
  "organization-profile:update": "org", "organization-profile:delete": "org",
  "organization-role:create": "org", "organization-role:update": "org", "organization-role:delete": "org",
  "permission:read": "org", "permission:create": "org", "permission:delete": "org",
};

const GROUP_DEFS: { id: string; label: string }[] = [
  { id: "sales",        label: "Sales & CRM" },
  { id: "procurement",  label: "Procurement" },
  { id: "fulfillment",  label: "Fulfillment & Finance" },
  { id: "products",     label: "Products" },
  { id: "inventory",    label: "Inventory" },
  { id: "hr",           label: "HR & People" },
  { id: "org",          label: "Organization & Admin" },
];

const PERM_GROUPS: PermGroup[] = GROUP_DEFS.map((g) => ({
  ...g,
  perms: ALL_MANAGED.filter((p) => KEY_GROUP[p.key] === g.id),
}));

// ── Avatar helpers ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: "#E6F1FB", color: "#185FA5" },
  { bg: "#EAF3DE", color: "#3B6D11" },
  { bg: "#FAEEDA", color: "#854F0B" },
  { bg: "#EEEDFE", color: "#534AB7" },
  { bg: "#FAECE7", color: "#993C1D" },
];
const avatarColor = (i: number) => AVATAR_COLORS[i % AVATAR_COLORS.length];

// ── Types ─────────────────────────────────────────────────────────────────────

type Member = {
  memberId: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  image?: string | null;
  permissions: { key: string; allowed: boolean }[];
};

type OverrideMap = Map<string, boolean>;

// ── MemberList ────────────────────────────────────────────────────────────────

function MemberList({
  members,
  selected,
  onSelect,
}: {
  members: Member[];
  selected: Member | null;
  onSelect: (m: Member) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      search
        ? members.filter(
            (m) =>
              m.name.toLowerCase().includes(search.toLowerCase()) ||
              m.email.toLowerCase().includes(search.toLowerCase()),
          )
        : members,
    [members, search],
  );

  return (
    <div className="flex flex-col border-r border-border h-full">
      <div className="p-3 border-b border-border shrink-0">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs bg-muted/40 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filtered.map((m, i) => {
          const av = avatarColor(members.indexOf(m));
          const isSelected = selected?.userId === m.userId;
          const activeCount = m.permissions.filter((p) => p.allowed).length;
          return (
            <button
              key={m.userId}
              onClick={() => onSelect(m)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors",
                isSelected
                  ? "bg-primary/10 border border-primary/25"
                  : "border border-transparent hover:bg-muted/50",
              )}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                style={{ background: av.bg, color: av.color }}
              >
                {m.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate leading-tight lowercase">{m.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span
                    className={cn(
                      "text-[10px] px-1.5 rounded font-medium capitalize leading-4",
                      m.role === "owner"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                        : m.role === "stakeholder"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.role}
                  </span>
                  {activeCount > 0 && (
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                      {activeCount} active
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No members found</p>
        )}
      </div>
    </div>
  );
}

// ── PresetsTab ────────────────────────────────────────────────────────────────

function PresetsTab({
  member,
  organizationId,
  overrides,
  onChange,
}: {
  member: Member;
  organizationId: string;
  overrides: OverrideMap;
  onChange: (updates: { key: string; allowed: boolean }[]) => void;
}) {
  const [pending, setPending] = useState<{ id: string; type: "grant" | "revoke" } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeKeys = useMemo(
    () => new Set([...overrides].filter(([, v]) => v).map(([k]) => k)),
    [overrides],
  );

  async function handleToggle(bundleId: string, keys: readonly string[], grant: boolean) {
    setPending({ id: bundleId, type: grant ? "grant" : "revoke" });
    const ks = keys as unknown as string[];
    const res = grant
      ? await bulkGrantPermissions(member.userId, organizationId, ks)
      : await bulkRevokePermissions(member.userId, organizationId, ks);
    if (res.success) {
      onChange(ks.map((k) => ({ key: k, allowed: grant })));
      toast.success(grant ? "Bundle granted" : "Bundle revoked");
    } else {
      toast.error(grant ? "Failed to grant bundle" : "Failed to revoke bundle");
    }
    setPending(null);
  }

  return (
    <div className="divide-y divide-border">
      {PERMISSION_BUNDLES.map((bundle) => {
        const grantedCount = bundle.permissions.filter((k) => activeKeys.has(k)).length;
        const fullyGranted = grantedCount === bundle.permissions.length;
        const partial = grantedCount > 0 && !fullyGranted;
        const isExp = expanded === bundle.id;
        const isGranting = pending?.id === bundle.id && pending.type === "grant";
        const isRevoking = pending?.id === bundle.id && pending.type === "revoke";
        const busy = isGranting || isRevoking;

        return (
          <div key={bundle.id} className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{bundle.label}</span>
                  <span className="text-[10px] font-mono bg-muted border border-border rounded px-1.5 py-0.5">
                    {bundle.permissions.length} perms
                  </span>
                  {fullyGranted && (
                    <span className="text-[10px] flex items-center gap-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
                      <CheckIcon className="w-2.5 h-2.5" /> All granted
                    </span>
                  )}
                  {partial && (
                    <span className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
                      {grantedCount}/{bundle.permissions.length} on
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {bundle.description}
                </p>
                <button
                  onClick={() => setExpanded(isExp ? null : bundle.id)}
                  className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDownIcon className={cn("w-3 h-3 transition-transform", isExp && "rotate-180")} />
                  {isExp ? "Hide" : "Show"} permissions
                </button>
                {isExp && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {bundle.permissions.map((key) => {
                      const on = activeKeys.has(key);
                      return (
                        <span
                          key={key}
                          className={cn(
                            "font-mono text-[10px] px-1.5 py-0.5 rounded border",
                            on
                              ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                              : "bg-muted text-muted-foreground border-border/50",
                          )}
                        >
                          {on ? "✓ " : ""}{key}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {busy ? (isGranting ? "Granting…" : "Revoking…") : fullyGranted ? "Granted" : "Off"}
                </span>
                <Switch
                  checked={fullyGranted}
                  disabled={busy}
                  onCheckedChange={(v) => handleToggle(bundle.id, bundle.permissions, v)}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PermissionsTab ────────────────────────────────────────────────────────────

function PermissionsTab({
  member,
  organizationId,
  overrides,
  onChange,
}: {
  member: Member;
  organizationId: string;
  overrides: OverrideMap;
  onChange: (updates: { key: string; allowed: boolean }[]) => void;
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const visibleGroups = useMemo(() => {
    if (!search) return PERM_GROUPS;
    const q = search.toLowerCase();
    return PERM_GROUPS.map((g) => ({
      ...g,
      perms: g.perms.filter(
        (p) => p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
      ),
    })).filter((g) => g.perms.length > 0);
  }, [search]);

  async function handleToggle(key: string, current: boolean) {
    setToggling(key);
    const next = !current;
    const res = await upsertUserPermission(member.userId, organizationId, key, next);
    if (res.success) {
      onChange([{ key, allowed: next }]);
    } else {
      toast.error("Failed to update permission");
    }
    setToggling(null);
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div>
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
        const onCount = group.perms.filter((p) => overrides.get(p.key)).length;

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
                  {onCount} on
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {group.perms.length} permissions
              </span>
            </button>

            {!isCollapsed && (
              <div>
                {group.perms.map((p, pi) => {
                  const allowed = overrides.get(p.key) ?? false;
                  const busy = toggling === p.key;

                  return (
                    <div
                      key={p.key}
                      className={cn(
                        "flex items-center gap-4 px-5 py-2.5 hover:bg-muted/10 transition-colors",
                        pi > 0 && "border-t border-border/40",
                      )}
                    >
                      <Switch
                        checked={allowed}
                        disabled={busy}
                        onCheckedChange={() => handleToggle(p.key, allowed)}
                      />
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{p.label}</span>
                      </div>
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
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AccessControlClient({
  members,
  organizationId,
}: {
  members: Member[];
  organizationId: string;
}) {
  const [selected, setSelected] = useState<Member | null>(null);
  const [overrides, setOverrides] = useState<OverrideMap>(new Map());
  const [activeTab, setActiveTab] = useState<"presets" | "permissions">("presets");

  function handleSelect(m: Member) {
    setSelected(m);
    setOverrides(new Map(m.permissions.map((p) => [p.key, p.allowed])));
    setActiveTab("presets");
  }

  function handleChange(updates: { key: string; allowed: boolean }[]) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const u of updates) next.set(u.key, u.allowed);
      return next;
    });
  }

  const activeCount = useMemo(
    () => [...overrides.values()].filter(Boolean).length,
    [overrides],
  );

  const selectedIdx = selected ? members.findIndex((m) => m.userId === selected.userId) : -1;
  const av = selectedIdx >= 0 ? avatarColor(selectedIdx) : null;

  return (
    <div className="p-6">
      <PageHeader
        title="Access control"
        description="Manage member permissions using preset bundles for quick setup, or configure individual permissions with fine-grained controls."
      />

      <div
        className="rounded-xl border border-border overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "256px 1fr", minHeight: 560 }}
      >
        {/* Left — member list */}
        <MemberList members={members} selected={selected} onSelect={handleSelect} />

        {/* Right — detail panel */}
        <div className="flex flex-col min-h-0 overflow-hidden border-l border-border">
          {!selected ? (
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground h-full py-20">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <ShieldIcon className="w-5 h-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium">Select a member</p>
              <p className="text-xs text-center max-w-xs leading-relaxed">
                Choose a member from the left panel to manage their access using preset bundles or individual permission toggles.
              </p>
            </div>
          ) : (
            <>
              {/* Member nameplate */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-muted/20 shrink-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                  style={{ background: av!.bg, color: av!.color }}
                >
                  {selected.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight lowercase">{selected.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{selected.email}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded font-medium capitalize",
                      selected.role === "owner"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                        : selected.role === "stakeholder"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-muted text-muted-foreground border border-border",
                    )}
                  >
                    {selected.role}
                  </span>
                  {activeCount > 0 && (
                    <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-0.5 font-medium">
                      {activeCount} active
                    </span>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border px-5 shrink-0">
                {(["presets", "permissions"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors capitalize",
                      activeTab === tab
                        ? "border-primary text-foreground font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab === "presets" ? "Quick Setup" : "Permissions"}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === "presets" ? (
                  <PresetsTab
                    member={selected}
                    organizationId={organizationId}
                    overrides={overrides}
                    onChange={handleChange}
                  />
                ) : (
                  <PermissionsTab
                    member={selected}
                    organizationId={organizationId}
                    overrides={overrides}
                    onChange={handleChange}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
