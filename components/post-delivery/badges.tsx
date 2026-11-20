import { CLAIM_STATUS, ISSUE_STATUS, SEVERITIES, clockText, type ClaimStatus, type Clock, type IssueStatus, type Severity } from "@/lib/post-delivery/core";

const ISSUE_CLS: Record<IssueStatus, string> = {
  open: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  investigating: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  claim_raised: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300",
  resolved: "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300",
  closed_no_claim: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const CLAIM_CLS: Record<ClaimStatus, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  sent: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  accepted: "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300",
  partial: "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-700 dark:bg-lime-900/20 dark:text-lime-300",
  rejected: "border-red-200 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300",
  closed: "border-border bg-muted text-muted-foreground",
  withdrawn: "border-border bg-muted text-muted-foreground line-through",
};
const base = "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium";

export const IssueStatusBadge = ({ status }: { status: IssueStatus }) => <span className={`${base} ${ISSUE_CLS[status]}`}>{ISSUE_STATUS[status]}</span>;
export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => <span className={`${base} ${CLAIM_CLS[status]}`}>{CLAIM_STATUS[status]}</span>;

export function SeverityFlags({ severity, safety }: { severity: string; safety: boolean }) {
  return (
    <>
      {safety && <span className={`${base} border-red-300 bg-red-600 text-white`}>Safety related</span>}
      {severity !== "normal" && <span className={`${base} ${severity === "urgent" ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300" : "border-orange-200 bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300"}`}>{SEVERITIES[severity as Severity] ?? severity}</span>}
    </>
  );
}

// how a claim stands against the supplier's deadline
export function DeadlineBadge({ clock, deadline }: { clock: Clock; deadline?: string | null }) {
  if (clock.state === "none") return <span className="text-[11px] text-muted-foreground">No deadline</span>;
  const cls = clock.state === "late" ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300" : clock.state === "soon" ? "border-orange-300 bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300" : "border-border text-muted-foreground";
  return <span className={`${base} ${cls}`} title={deadline ?? undefined}>{clockText(clock)}</span>;
}
