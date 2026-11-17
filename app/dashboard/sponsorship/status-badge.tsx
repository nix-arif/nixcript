import { STATUS_LABEL, type SponsorshipStatus } from "@/lib/sponsorship/core";

const CLS: Record<SponsorshipStatus, string> = {
  DRAFT: "border-border bg-muted text-muted-foreground",
  PENDING: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  CHECKED: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  APPROVED: "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300",
  REJECTED: "border-red-200 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300",
  CANCELLED: "border-border bg-muted text-muted-foreground",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300",
};

export function SponsorshipStatusBadge({ status }: { status: SponsorshipStatus }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}
