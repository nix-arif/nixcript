"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupplierClaims, type ClaimListRow } from "@/server/post-delivery";
import { situationLabel, clockOf, todayKL, CLAIM_OUTCOMES } from "@/lib/post-delivery/core";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClaimStatusBadge, DeadlineBadge } from "@/components/post-delivery/badges";
import { ClipboardCheckIcon, SearchIcon, SettingsIcon } from "lucide-react";

type Tab = "action" | "waiting" | "done" | "all";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "action", label: "Needs action", hint: "Drafts to send, answers to close, rejected claims to decide on, and follow-ups that are due" },
  { key: "waiting", label: "Waiting for the supplier", hint: "Sent, no answer yet" },
  { key: "done", label: "Finished", hint: "Closed or withdrawn" },
  { key: "all", label: "All", hint: "" },
];
const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function ClaimsListClient({ initial, canSetTerms }: { initial: ClaimListRow[]; canSetTerms: boolean }) {
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<Tab>("action");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(async () => { setLoading(true); setRows(await getSupplierClaims({ tab, q })); setLoading(false); }, 250);
    return () => clearTimeout(t);
  }, [tab, q]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <PageHeader
        title="Supplier Claims"
        description="Claims against suppliers for problems found after delivery, with each supplier's own deadline"
        action={canSetTerms ? <Button asChild variant="outline" className="gap-2"><Link href="/dashboard/procurement/supplier-claims/terms"><SettingsIcon className="h-4 w-4" />Claim terms</Link></Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search claim no, issue, supplier" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap rounded-lg border border-border p-0.5 text-xs" role="tablist">
          {TABS.map((t) => <button key={t.key} type="button" role="tab" title={t.hint} aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-md px-3 py-1.5 ${tab === t.key ? "bg-muted font-medium" : "text-muted-foreground"}`}>{t.label}</button>)}
        </div>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <ClipboardCheckIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-1 text-sm font-medium">{q ? "No claim matches your search" : tab === "action" ? "Nothing needs action" : "No claims here"}</div>
          <p className="mx-auto max-w-sm text-xs">Claims are raised from a customer issue, once the supplier of the affected units is known.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-left font-medium">Claim</th><th className="px-3 py-2 text-left font-medium">Supplier</th><th className="px-3 py-2 text-left font-medium">Problem</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Deadline to send</th><th className="px-3 py-2 text-left font-medium">Sent</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-2"><Link href={`/dashboard/procurement/supplier-claims/${r.id}`} className="font-mono text-xs font-semibold hover:underline">{r.claimNo}</Link><div className="text-[11px] text-muted-foreground">{r.issueNo} · {r.itemCount} item{r.itemCount === 1 ? "" : "s"}</div></td>
                  <td className="px-3 py-2">{r.supplierName}</td>
                  <td className="px-3 py-2 text-xs">{situationLabel(r.situation)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1"><ClaimStatusBadge status={r.status} />{r.outcome && r.status !== "sent" && <span className="text-[11px] text-muted-foreground">{CLAIM_OUTCOMES[r.outcome as keyof typeof CLAIM_OUTCOMES] ?? r.outcome}</span>}</div>
                    {r.followUpDue && <div className="mt-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">Follow-up due</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.status === "draft" ? <div className="space-y-0.5"><div className="tabular-nums">{fmt(r.deadlineDate)}</div><DeadlineBadge clock={clockOf(r.deadlineDate, todayKL())} deadline={r.deadlineDate} /></div> : <span className="text-muted-foreground">{r.deadlineDate ? fmt(r.deadlineDate) : "—"}</span>}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{fmt(r.sentAt)}{r.sentLate && <div className="text-[11px] text-red-700 dark:text-red-400">after their deadline</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
