"use client";

import type { ReactNode } from "react";
import { CheckCircle2Icon } from "lucide-react";

// Shown on a document's form right after it was saved as a draft — the user
// stays on the form (no redirect) and sees that it's saved, under which
// number, and when. "just-now": arrived here from the create form, which
// saved it a moment ago (no clock time on the first render: the server's
// time zone would make it mismatch the browser's).
export function DraftSavedNote({ docNo, savedAt, action }: { docNo?: string | null; savedAt: Date | "just-now" | null; action?: ReactNode }) {
  if (!savedAt) return null;
  const time = savedAt === "just-now" ? "just now" : savedAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
    >
      <CheckCircle2Icon className="h-4 w-4 shrink-0" />
      <span>
        Draft saved{docNo ? <> · <span className="font-mono font-medium">{docNo}</span></> : null} · {time}. Keep editing, or submit when you&apos;re ready.
      </span>
      {action && <span className="ml-auto shrink-0">{action}</span>}
    </div>
  );
}
