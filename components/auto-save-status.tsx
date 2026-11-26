"use client";

import { AlertCircleIcon, CheckIcon, Loader2Icon } from "lucide-react";
import type { AutoSaveStatus as Status } from "@/lib/use-auto-save";

// The small "Saving… / Draft saved" line on a form that auto-saves (lib/use-auto-save.ts).
// waiting: why it can't save yet (e.g. "Please link at least one Customer PO"), shown while nothing is saved.
export function AutoSaveStatus({
  status,
  savedAt,
  error,
  docNo,
  waiting,
}: {
  status: Status;
  savedAt: Date | null;
  error?: string | null;
  docNo?: string | null;
  waiting?: string | null;
}) {
  if (status === "saving")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> Saving draft…
      </span>
    );
  if (status === "error")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs text-destructive" title={error ?? undefined}>
        <AlertCircleIcon className="h-3.5 w-3.5" /> Couldn&apos;t save the draft{error ? `: ${error}` : ""}. It will try again on your next change.
      </span>
    );
  if (savedAt)
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
        <CheckIcon className="h-3.5 w-3.5" />
        Draft saved{docNo ? <> · <span className="font-mono">{docNo}</span></> : null} ·{" "}
        {savedAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  if (waiting)
    return <span className="text-xs text-muted-foreground">Auto-saves as a draft once it can be saved ({waiting.replace(/^please /i, "").replace(/\.$/, "")}).</span>;
  return null;
}
