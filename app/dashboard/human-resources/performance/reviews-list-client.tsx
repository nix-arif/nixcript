"use client";

import Link from "next/link";
import { ClipboardCheckIcon, ArrowRightIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatScore } from "@/lib/performance/core";
import type { ReviewListRow } from "@/server/performance";
import { ReviewStatusBadge } from "./status-badge";

const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "");

export function ReviewsListClient({ rows, variant }: { rows: ReviewListRow[]; variant: "mine" | "team" }) {
  const mine = variant === "mine";
  // what is waiting for this person comes first
  const waiting = (r: ReviewListRow) => (mine ? r.status === "self" : r.status === "manager");
  const sorted = [...rows].sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
  const todo = rows.filter(waiting).length;

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <PageHeader
        title={mine ? "My Performance Reviews" : "Team Reviews"}
        description={mine ? "Complete your self-assessment and read your results" : "Reviews of the people assigned to you"}
        action={todo > 0 ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{todo} waiting for you</span> : undefined}
      />
      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <ClipboardCheckIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <div className="mb-1 text-sm font-medium">{mine ? "No reviews yet" : "Nobody to review right now"}</div>
          <p className="mx-auto max-w-sm text-xs">{mine ? "When HR opens a review period for you, it appears here." : "Reviews appear here once HR assigns you as the reviewer."}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{mine ? r.periodName : r.employeeName}</span>
                  {!mine && <span className="text-xs text-muted-foreground">{r.periodName}</span>}
                  <ReviewStatusBadge status={r.status} short />
                  {r.periodStatus === "closed" && <span className="rounded-md border border-border px-1.5 py-px text-[10px] text-muted-foreground">Period closed</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDate(r.startDate)} to {fmtDate(r.endDate)}
                  {mine && r.reviewerName ? ` · Reviewer: ${r.reviewerName}` : ""}
                  {r.status === "completed" && r.finalScore ? ` · Score ${formatScore(r.finalScore, r.scaleMax)}` : ""}
                </div>
                {!mine && r.returnNote && r.status === "manager" && <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">Sent back by HR: {r.returnNote}</div>}
              </div>
              <Button asChild size="sm" variant={waiting(r) ? "default" : "outline"} className="gap-1.5">
                <Link href={`/dashboard/human-resources/performance/review/${r.id}`}>
                  {waiting(r) ? (mine ? "Complete" : "Review") : "Open"}
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
