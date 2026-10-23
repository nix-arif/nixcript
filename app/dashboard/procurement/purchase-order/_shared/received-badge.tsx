import { cn } from "@/lib/utils";

// Statuses where receiving applies — a draft/cancelled PO can't have been received
const RECEIVING_STATUSES = new Set(["submitted", "confirmed", "fulfilled"]);

/** "NN% received" with a slim progress bar, for the supplier PO list cards. */
export function ReceivedBadge({ status, pct }: { status: string; pct: number }) {
  if (!RECEIVING_STATUSES.has(status)) return null;
  const done = pct >= 100;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border",
        done
          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
          : pct > 0
            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
            : "bg-muted/40 text-muted-foreground border-border/60",
      )}
      title={`${pct}% of the ordered quantity received`}
    >
      <span className="w-8 h-1 rounded-full bg-current/20 overflow-hidden">
        <span className="block h-full rounded-full bg-current" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      {pct}% received
    </span>
  );
}
