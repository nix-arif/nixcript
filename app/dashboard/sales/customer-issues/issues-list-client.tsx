"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCustomerIssues, type IssueListRow } from "@/server/post-delivery";
import { situationLabel, clockOf, todayKL } from "@/lib/post-delivery/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IssueStatusBadge, SeverityFlags, DeadlineBadge } from "@/components/post-delivery/badges";
import { MessageSquareWarningIcon, PlusIcon, SearchIcon } from "lucide-react";

const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
const daysOpen = (d: string) => Math.max(0, Math.round((Date.parse(`${todayKL()}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000));

export function IssuesListClient({ initial, canCreate }: { initial: IssueListRow[]; canCreate: boolean }) {
  const [rows, setRows] = useState(initial);
  const [scope, setScope] = useState<"live" | "all">("live");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(async () => { setLoading(true); setRows(await getCustomerIssues({ scope, q })); setLoading(false); }, 250);
    return () => clearTimeout(t);
  }, [scope, q]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <PageHeader
        title="Customer Issues"
        description="Problems the customer reports after delivery, and the claims raised against suppliers because of them"
        action={canCreate ? <Button asChild className="gap-2"><Link href="/dashboard/sales/customer-issues/new"><PlusIcon className="h-4 w-4" />Report an issue</Link></Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search issue no, customer, DO or problem" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-lg border border-border p-0.5 text-xs" role="tablist">
          {([["live", "Being worked on"], ["all", "All"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={scope === k} onClick={() => setScope(k)} className={`rounded-md px-3 py-1.5 ${scope === k ? "bg-muted font-medium" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <MessageSquareWarningIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-1 text-sm font-medium">{q ? "No issue matches your search" : scope === "live" ? "No open customer issues" : "No customer issues yet"}</div>
          <p className="mx-auto max-w-sm text-xs">When a customer reports a problem with something delivered, report it here. The units, the photos and who supplied them are kept together, so a claim can be raised against the supplier in time.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-left font-medium">Issue</th><th className="px-3 py-2 text-left font-medium">Customer</th><th className="px-3 py-2 text-left font-medium">Problem</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Claims</th><th className="px-3 py-2 text-right font-medium">Reported</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-2"><Link href={`/dashboard/sales/customer-issues/${r.id}`} className="font-mono text-xs font-semibold hover:underline">{r.issueNo}</Link>{r.deliveryOrderNo && <div className="text-[11px] text-muted-foreground">{r.deliveryOrderNo}</div>}</td>
                  <td className="px-3 py-2">{r.customerName}</td>
                  <td className="max-w-72 px-3 py-2"><div className="truncate font-medium" title={r.summary}>{r.summary}</div><div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">{situationLabel(r.situation)} · {r.itemCount} item{r.itemCount === 1 ? "" : "s"} <SeverityFlags severity={r.severity} safety={r.safetyRelated} /></div></td>
                  <td className="px-3 py-2"><IssueStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-xs">
                    {r.claimCount === 0 ? <span className="text-muted-foreground">None</span> : <div className="space-y-0.5"><div>{r.claimCount} claim{r.claimCount === 1 ? "" : "s"}</div>{r.nearestDeadline && <DeadlineBadge clock={clockOf(r.nearestDeadline, todayKL())} deadline={r.nearestDeadline} />}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums"><div>{fmt(r.reportedAt)}</div><div className="text-muted-foreground">{daysOpen(r.reportedAt)} days ago</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
