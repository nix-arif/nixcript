import { STATUS_LABEL, type ReviewStatus } from "@/lib/performance/core";

const CLS: Record<ReviewStatus, string> = {
  self: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  manager: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  signoff: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300",
  completed: "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function ReviewStatusBadge({ status, short = false }: { status: ReviewStatus; short?: boolean }) {
  const label = short ? { self: "Self-assessment", manager: "Manager review", signoff: "HR sign-off", completed: "Completed", cancelled: "Cancelled" }[status] : STATUS_LABEL[status];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${CLS[status]}`}>{label}</span>;
}
