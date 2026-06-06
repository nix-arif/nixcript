"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard/error]", error);
  }, [error]);

  const router = useRouter();

  const message =
    error.message && !error.message.toLowerCase().includes("internal")
      ? error.message
      : "Something went wrong. Please try again or go back.";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangleIcon className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">An error occurred</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">{message}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeftIcon className="w-3.5 h-3.5 mr-1.5" />
          Go back
        </Button>
        <Button size="sm" onClick={reset}>
          <RefreshCwIcon className="w-3.5 h-3.5 mr-1.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}
