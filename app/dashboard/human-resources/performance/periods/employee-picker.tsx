"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EligibleEmployee } from "@/server/performance";

export type Picked = Record<string, { reviewerUserId: string | null }>; // userId -> reviewer

// Choose who is reviewed and by whom. The reviewer starts as the manager of the person's department.
export function EmployeePicker({
  employees, value, onChange, excludeIds = [],
}: {
  employees: EligibleEmployee[];
  value: Picked;
  onChange: (v: Picked) => void;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter((e) => !excludeIds.includes(e.userId) && (!needle || e.name.toLowerCase().includes(needle) || e.departments.some((d) => d.toLowerCase().includes(needle))));
  }, [employees, q, excludeIds]);
  const allOn = list.length > 0 && list.every((e) => value[e.userId]);

  const toggle = (e: EligibleEmployee) => {
    const next = { ...value };
    if (next[e.userId]) delete next[e.userId]; else next[e.userId] = { reviewerUserId: e.defaultReviewer?.userId ?? null };
    onChange(next);
  };
  const toggleAll = () => {
    const next = { ...value };
    for (const e of list) { if (allOn) delete next[e.userId]; else if (!next[e.userId]) next[e.userId] = { reviewerUserId: e.defaultReviewer?.userId ?? null }; }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search name or department" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="whitespace-nowrap text-xs underline text-muted-foreground hover:text-foreground" onClick={toggleAll}>{allOn ? "Clear" : "Select all"}</button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
        {list.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No one to show.</p>}
        {list.map((e) => {
          const on = !!value[e.userId];
          return (
            <div key={e.userId} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${on ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""}`}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={on} onChange={() => toggle(e)} className="h-4 w-4" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{e.departments.join(", ") || "No department"}</span>
                </span>
              </label>
              {on && (
                <select
                  className="h-8 max-w-48 rounded-md border border-input bg-background px-2 text-xs"
                  value={value[e.userId].reviewerUserId ?? ""}
                  onChange={(ev) => onChange({ ...value, [e.userId]: { reviewerUserId: ev.target.value || null } })}
                  aria-label={`Reviewer for ${e.name}`}
                >
                  <option value="">{e.defaultReviewer ? "No reviewer yet" : "No manager found, pick one"}</option>
                  {employees.filter((x) => x.userId !== e.userId).map((x) => <option key={x.userId} value={x.userId}>{x.name}{x.userId === e.defaultReviewer?.userId ? " (dept. manager)" : ""}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{Object.keys(value).length} selected. The reviewer is the manager of the person&apos;s department; change it if someone else should review.</p>
    </div>
  );
}
