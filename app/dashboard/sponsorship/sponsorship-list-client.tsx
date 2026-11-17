"use client";

import { useState } from "react";
import Link from "next/link";
import { HandshakeIcon, PlusIcon, SearchIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtRM, money, RECIPIENT_TYPES, type SponsorshipStatus } from "@/lib/sponsorship/core";
import type { SponsorshipListRow } from "@/server/sponsorship";
import { SponsorshipStatusBadge } from "./status-badge";

export type ListVariant = "mine" | "check" | "approve" | "all";
const COPY: Record<ListVariant, { title: string; description: string; empty: string }> = {
  mine: { title: "My Sponsorship Requests", description: "Request sponsorship for a doctor, hospital, association or event and follow it", empty: "You have no sponsorship requests yet." },
  check: { title: "Sponsorship Checker", description: "Requests waiting for your first-level check", empty: "Nothing is waiting to be checked." },
  approve: { title: "Sponsorship Approvals", description: "Requests waiting for a decision", empty: "Nothing is waiting for approval." },
  all: { title: "All Sponsorships", description: "Every sponsorship, with what was approved and what was spent", empty: "No sponsorships yet." },
};
const FILTERS: (SponsorshipStatus | "ALL")[] = ["ALL", "PENDING", "CHECKED", "APPROVED", "CLOSED", "REJECTED", "CANCELLED"];

export function SponsorshipListClient({ rows, variant }: { rows: SponsorshipListRow[]; variant: ListVariant }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<SponsorshipStatus | "ALL">("ALL");
  const c = COPY[variant];
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (status === "ALL" || r.status === status) && (!needle || [r.sponsorshipNo, r.title, r.recipientName, r.requestedByName].some((x) => x.toLowerCase().includes(needle))));
  const totals = variant === "all" ? { approved: shown.filter((r) => r.status === "APPROVED" || r.status === "CLOSED").reduce((s, r) => s + money(r.approvedAmount), 0), spent: shown.reduce((s, r) => s + money(r.actualAmount), 0) } : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <PageHeader title={c.title} description={c.description}
        action={variant === "mine" ? <Button asChild className="gap-2"><Link href="/dashboard/sponsorship/new"><PlusIcon className="h-4 w-4" />New request</Link></Button> : undefined} />

      {(variant === "mine" || variant === "all") && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative"><SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="h-9 w-60 pl-8" placeholder="Search number, event, recipient" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => <button key={f} type="button" onClick={() => setStatus(f)} className={`rounded-full border px-3 py-1 text-xs ${status === f ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"}`}>{f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}</button>)}
          </div>
          {totals && <span className="ml-auto text-xs text-muted-foreground">Approved {fmtRM(totals.approved)} · Spent {fmtRM(totals.spent)}</span>}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <HandshakeIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-3 text-sm">{rows.length === 0 ? c.empty : "No sponsorship matches."}</div>
          {variant === "mine" && rows.length === 0 && <Button asChild variant="outline" size="sm"><Link href="/dashboard/sponsorship/new">Create the first request</Link></Button>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">No.</th><th className="px-4 py-2 text-left font-medium">Event / recipient</th>{variant !== "mine" && <th className="px-4 py-2 text-left font-medium">Requested by</th>}<th className="px-4 py-2 text-right font-medium">Requested</th>{(variant === "all" || variant === "mine") && <th className="px-4 py-2 text-right font-medium">Approved</th>}{variant === "all" && <th className="px-4 py-2 text-right font-medium">Spent</th>}<th className="px-4 py-2 text-left font-medium">Status</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs"><Link className="underline-offset-2 hover:underline" href={r.status === "DRAFT" ? `/dashboard/sponsorship/${r.id}/edit` : `/dashboard/sponsorship/${r.id}`}>{r.sponsorshipNo}</Link></td>
                  <td className="px-4 py-2"><div className="font-medium">{r.title || "(untitled)"}</div><div className="text-xs text-muted-foreground">{r.recipientName || "—"} · {RECIPIENT_TYPES.find((t) => t.value === r.recipientType)?.label ?? r.recipientType}</div></td>
                  {variant !== "mine" && <td className="px-4 py-2 text-xs">{r.requestedByName}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">{fmtRM(r.totalRequested)}</td>
                  {(variant === "all" || variant === "mine") && <td className="px-4 py-2 text-right tabular-nums text-xs">{r.approvedAmount ? fmtRM(r.approvedAmount) : "—"}</td>}
                  {variant === "all" && <td className="px-4 py-2 text-right tabular-nums text-xs">{r.actualAmount ? fmtRM(r.actualAmount) : "—"}{r.paidAt ? <span className="ml-1 text-green-700 dark:text-green-400">paid</span> : null}</td>}
                  <td className="px-4 py-2"><SponsorshipStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
