"use client";

import React from "react";
import { PageHeader } from "@/components/page-header";
import {
  ALL_PERMISSIONS,
  STAKEHOLDER_PERMISSIONS,
  DEPT_ROLE_PERMISSIONS,
} from "@/lib/permissions/constants";
import { LockIcon, EyeIcon, BriefcaseIcon, UserIcon } from "lucide-react";

type Department = { id: string; name: string; isDefault: boolean };

const groupedPermissions = ALL_PERMISSIONS.reduce(
  (acc, p) => {
    const resource = p.key.split(":")[0];
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(p);
    return acc;
  },
  {} as Record<string, (typeof ALL_PERMISSIONS)[number][]>,
);

const stakeholderSet = new Set<string>(STAKEHOLDER_PERMISSIONS);

const ROLE_CARDS = [
  {
    name: "Owner",
    icon: LockIcon,
    bg: "#FAEEDA",
    color: "#854F0B",
    description: "Full access to everything. Owns the organization and can invite members.",
    badge: "system",
  },
  {
    name: "Stakeholder",
    icon: EyeIcon,
    bg: "#E6F1FB",
    color: "#185FA5",
    description: "Read-only access across all areas. Cannot create, edit, or delete anything.",
    badge: "system",
  },
  {
    name: "Manager",
    icon: BriefcaseIcon,
    bg: "#EAF3DE",
    color: "#3B6D11",
    description: "Department lead. Full write access within their department's scope.",
    badge: "dept-based",
  },
  {
    name: "Member",
    icon: UserIcon,
    bg: "#EEEDFE",
    color: "#534AB7",
    description: "Standard department access. Can read and create within their scope.",
    badge: "dept-based",
  },
];

function CheckIcon() {
  return (
    <div className="w-4 h-4 rounded bg-green-600 flex items-center justify-center shrink-0">
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
  );
}

function EmptyIcon() {
  return <div className="w-4 h-4 rounded border-2 border-border shrink-0" />;
}

export function RolesClient({ departments }: { departments: Department[] }) {
  const [selectedDept, setSelectedDept] = React.useState<string>(
    departments[0]?.name ?? "",
  );

  const deptPerms = DEPT_ROLE_PERMISSIONS[selectedDept] ?? {
    manager: [],
    member: [],
  };
  const managerSet = new Set<string>(deptPerms.manager);
  const memberSet = new Set<string>(deptPerms.member);

  return (
    <div className="p-6">
      <PageHeader
        title="Access levels"
        description="The four roles used across this organization. Manager and Member permissions vary by department."
      />

      {/* Role summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-4">
        {ROLE_CARDS.map(({ name, icon: Icon, bg, color, description, badge }) => (
          <div
            key={name}
            className="rounded-lg border border-border p-4 bg-background"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: bg, color }}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-medium">{name}</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  badge === "system"
                    ? "bg-gray-100 text-gray-600"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                {badge}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
        ))}
      </div>

      {/* Department selector */}
      <div className="mb-4">
        <div className="text-sm font-medium mb-3">
          Department permissions
          <span className="text-xs font-normal text-muted-foreground ml-2">
            — select a department to see what Manager and Member can access
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDept(d.name)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                selectedDept === d.name
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {/* Permission matrix */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div
          className="grid bg-muted/40 border-b border-border"
          style={{ gridTemplateColumns: "1fr 100px 100px 100px" }}
        >
          <div className="px-3 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider border-r border-border self-center">
            Permission
          </div>
          {(
            [
              { name: "Stakeholder", icon: EyeIcon,        bg: "#E6F1FB", color: "#185FA5" },
              { name: "Manager",     icon: BriefcaseIcon,  bg: "#EAF3DE", color: "#3B6D11" },
              { name: "Member",      icon: UserIcon,        bg: "#EEEDFE", color: "#534AB7" },
            ] as const
          ).map(({ name, icon: Icon, bg, color }) => (
            <div
              key={name}
              className="flex flex-col items-center gap-1.5 py-3 border-r border-border last:border-r-0"
            >
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: bg, color }}
              >
                <Icon className="w-3 h-3" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {name}
              </span>
            </div>
          ))}
        </div>

        {Object.entries(groupedPermissions).map(([resource, perms]) => (
          <React.Fragment key={resource}>
            <div
              className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/20 border-b border-border"
              style={{ gridColumn: "1 / -1" }}
            >
              {resource}
            </div>
            {perms.map((p) => (
              <div
                key={p.key}
                className="grid border-b border-border last:border-b-0 hover:bg-muted/10"
                style={{ gridTemplateColumns: "1fr 100px 100px 100px" }}
              >
                <div className="px-3 py-2 border-r border-border">
                  <span className="font-mono text-xs text-foreground/70">
                    {p.key}
                  </span>
                  {p.label && (
                    <span className="text-xs text-muted-foreground/50 ml-2">
                      {p.label}
                    </span>
                  )}
                </div>
                {[stakeholderSet, managerSet, memberSet].map((set, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center border-r border-border last:border-r-0 py-2"
                  >
                    {set.has(p.key) ? <CheckIcon /> : <EmptyIcon />}
                  </div>
                ))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
