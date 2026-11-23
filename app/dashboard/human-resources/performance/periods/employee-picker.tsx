"use client";

import { useMemo, useState } from "react";
import { SearchIcon, UsersIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PURPOSES, type ReviewPurpose } from "@/lib/performance/core";
import type { EligibleEmployee } from "@/server/performance";

// userId -> reviewer, purpose of the review, and the company the review is kept under
export type Picked = Record<string, { reviewerUserId: string | null; purpose: ReviewPurpose; organizationId: string }>;

// Choose who is reviewed and by whom, across every company of the owner. The reviewer starts as the manager of the
// person's own department; HR can change one by one, or set the purpose / reset the reviewers for everyone selected.
// Someone in several companies has their review kept under one of them, which HR picks (their own one to start with).
export function EmployeePicker({
  employees, value, onChange, excludeIds = [],
}: {
  employees: EligibleEmployee[];
  value: Picked;
  onChange: (v: Picked) => void;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("all");
  const pool = useMemo(() => employees.filter((e) => !excludeIds.includes(e.userId)), [employees, excludeIds]);
  const companies = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const e of pool) { const c = seen.get(e.organizationId) ?? { id: e.organizationId, name: e.organizationName, count: 0 }; c.count++; seen.set(e.organizationId, c); }
    return [...seen.values()];
  }, [pool]);
  const several = companies.length > 1;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((e) => (company === "all" || e.organizationId === company) && (!needle || e.name.toLowerCase().includes(needle) || e.departments.some((d) => d.toLowerCase().includes(needle))));
  }, [pool, q, company]);
  const groups = useMemo(() => {
    const out: { id: string; name: string; people: EligibleEmployee[] }[] = [];
    for (const e of shown) {
      let g = out.find((x) => x.id === e.organizationId);
      if (!g) { g = { id: e.organizationId, name: e.organizationName, people: [] }; out.push(g); }
      g.people.push(e);
    }
    return out;
  }, [shown]);

  // the department manager in the company the review is kept under
  const reviewerIn = (e: EligibleEmployee, orgId: string) => (e.companies.find((c) => c.id === orgId)?.defaultReviewer ?? (orgId === e.organizationId ? e.defaultReviewer : null))?.userId ?? null;
  const entryFor = (e: EligibleEmployee): Picked[string] => ({ reviewerUserId: e.defaultReviewer?.userId ?? null, purpose: "annual", organizationId: e.organizationId });
  // a new company brings its department manager as reviewer, unless HR had already picked someone else
  const setCompanyOf = (e: EligibleEmployee, orgId: string) => {
    const cur = value[e.userId];
    const keepReviewer = cur.reviewerUserId !== reviewerIn(e, cur.organizationId);
    onChange({ ...value, [e.userId]: { ...cur, organizationId: orgId, reviewerUserId: keepReviewer ? cur.reviewerUserId : reviewerIn(e, orgId) } });
  };
  const setMany = (list: EligibleEmployee[], on: boolean) => {
    const next = { ...value };
    for (const e of list) { if (on) { if (!next[e.userId]) next[e.userId] = entryFor(e); } else delete next[e.userId]; }
    onChange(next);
  };
  const toggle = (e: EligibleEmployee) => setMany([e], !value[e.userId]);
  const picked = pool.filter((e) => value[e.userId]);
  const everyone = pool.length > 0 && picked.length === pool.length;
  const noReviewer = picked.filter((e) => !value[e.userId].reviewerUserId);
  const pickedCompanies = new Set(picked.map((e) => value[e.userId].organizationId)).size;

  const setPurposeForAll = (purpose: ReviewPurpose) => {
    const next = { ...value };
    for (const e of picked) next[e.userId] = { ...next[e.userId], purpose };
    onChange(next);
  };
  const resetReviewers = () => {
    const next = { ...value };
    for (const e of picked) next[e.userId] = { ...next[e.userId], reviewerUserId: reviewerIn(e, next[e.userId].organizationId) };
    onChange(next);
  };

  return (
    <div className="space-y-2.5">
      {/* the one-click way to apply the template to everybody */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-900/10">
        <UsersIcon className="h-4 w-4 text-indigo-600" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">{pool.length} {pool.length === 1 ? "person" : "people"}</span>
          <span className="text-muted-foreground">{several ? ` in ${companies.length} companies` : ""} can be reviewed.</span>
        </div>
        <button type="button" className="rounded-md border border-indigo-300 bg-background px-2.5 py-1 text-xs font-medium hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/20" onClick={() => setMany(pool, !everyone)}>
          {everyone ? "Clear everyone" : `Select everyone${several ? " in all companies" : ""}`}
        </button>
      </div>

      {several && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Company">
          {[{ id: "all", name: "All companies", count: pool.length }, ...companies].map((c) => {
            const n = c.id === "all" ? picked.length : picked.filter((e) => e.organizationId === c.id).length;
            return (
              <button key={c.id} type="button" role="tab" aria-selected={company === c.id} onClick={() => setCompany(c.id)}
                className={`rounded-full border px-2.5 py-1 text-xs ${company === c.id ? "border-indigo-500 bg-indigo-50 font-medium dark:bg-indigo-900/20" : "border-border text-muted-foreground hover:bg-muted/30"}`}>
                {c.name} <span className="tabular-nums text-muted-foreground">{n}/{c.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search name or department" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length > 0 && (
          <button type="button" className="whitespace-nowrap text-xs underline text-muted-foreground hover:text-foreground" onClick={() => setMany(shown, !shown.every((e) => value[e.userId]))}>
            {shown.every((e) => value[e.userId]) ? "Clear shown" : `Select shown (${shown.length})`}
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No one to show.</p>}
        {groups.map((g) => {
          const allIn = g.people.every((e) => value[e.userId]);
          const n = g.people.filter((e) => value[e.userId]).length;
          return (
            <div key={g.id}>
              {several && (
                <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2.5 border-b border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold backdrop-blur">
                  <input type="checkbox" checked={allIn} onChange={() => setMany(g.people, !allIn)} className="h-3.5 w-3.5" />
                  <span className="flex-1">{g.name}</span>
                  <span className="font-normal tabular-nums text-muted-foreground">{n} of {g.people.length}</span>
                </label>
              )}
              <div className="divide-y divide-border/60">
                {g.people.map((e) => {
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
                      {on && e.companies.length > 1 && (
                        <select className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs" value={value[e.userId].organizationId}
                          onChange={(ev) => setCompanyOf(e, ev.target.value)} aria-label={`Company the review of ${e.name} is kept under`} title="The company this review is kept under: its letterhead, its HR and its department manager">
                          {e.companies.map((c) => <option key={c.id} value={c.id}>Under {c.name}</option>)}
                        </select>
                      )}
                      {on && (
                        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={value[e.userId].purpose}
                          onChange={(ev) => onChange({ ...value, [e.userId]: { ...value[e.userId], purpose: ev.target.value as ReviewPurpose } })} aria-label={`Purpose of the review for ${e.name}`}>
                          {(Object.keys(PURPOSES) as ReviewPurpose[]).map((k) => <option key={k} value={k}>{PURPOSES[k]}</option>)}
                        </select>
                      )}
                      {on && (
                        <select className={`h-8 max-w-48 rounded-md border bg-background px-2 text-xs ${value[e.userId].reviewerUserId ? "border-input" : "border-amber-400"}`} value={value[e.userId].reviewerUserId ?? ""}
                          onChange={(ev) => onChange({ ...value, [e.userId]: { ...value[e.userId], reviewerUserId: ev.target.value || null } })} aria-label={`Reviewer for ${e.name}`}>
                          <option value="">{e.defaultReviewer ? "No reviewer yet" : "No manager found, pick one"}</option>
                          {employees.filter((x) => x.userId !== e.userId).map((x) => <option key={x.userId} value={x.userId}>{x.name}{several ? ` (${x.organizationName})` : ""}{x.userId === reviewerIn(e, value[e.userId].organizationId) ? " · dept. manager" : ""}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {picked.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-muted/30 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">{picked.length} selected{pickedCompanies > 1 ? ` in ${pickedCompanies} companies` : ""}</span>
            <label className="flex items-center gap-1.5 text-muted-foreground">Purpose for all:
              <select className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground" value="" onChange={(e) => e.target.value && setPurposeForAll(e.target.value as ReviewPurpose)}>
                <option value="">choose…</option>
                {(Object.keys(PURPOSES) as ReviewPurpose[]).map((k) => <option key={k} value={k}>{PURPOSES[k]}</option>)}
              </select>
            </label>
            <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={resetReviewers}>Use department managers as reviewers</button>
          </div>
          {noReviewer.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {noReviewer.length} {noReviewer.length === 1 ? "person has" : "people have"} no reviewer yet ({noReviewer.slice(0, 3).map((e) => e.name).join(", ")}{noReviewer.length > 3 ? ` and ${noReviewer.length - 3} more` : ""}). You can open the period and assign them later, but their review will wait until a reviewer is set.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
