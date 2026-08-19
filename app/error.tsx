"use client";

import { useEffect } from "react";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root/error]", error);
  }, [error]);

  const message =
    error.message && !error.message.toLowerCase().includes("internal")
      ? error.message
      : "Something went wrong. Please try again.";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangleIcon className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">An error occurred</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">{message}</p>
          {error.digest && (
            <p className="mt-2 text-[11px] text-muted-foreground/60 font-mono">Ref: {error.digest}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <a
          href="/dashboard"
          className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent transition-colors"
        >
          Go to dashboard
        </a>
        <button
          onClick={reset}
          className="inline-flex items-center h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors gap-1.5"
        >
          <RefreshCwIcon className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}
