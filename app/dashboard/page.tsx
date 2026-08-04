import React from "react";
import { ShieldOffIcon } from "lucide-react";
import { ensureProfileExists } from "@/server/profile";
import { getCurrentUser } from "@/server/users";
import { getDashboardSummary } from "@/server/dashboard";
import { DashboardClient } from "./dashboard-client";

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) => {
  const params = await searchParams;

  const [session, summary] = await Promise.all([
    getCurrentUser(),
    ensureProfileExists().then(() => getDashboardSummary()).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-0">
      {params.error === "forbidden" && (
        <div className="flex items-start gap-3 p-4 mx-6 mt-6 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <ShieldOffIcon className="w-4 h-4 mt-0.5 shrink-0" />
          You don&apos;t have permission to access that page.
        </div>
      )}

      {summary ? (
        <DashboardClient summary={summary} userName={session?.user?.name ?? null} />
      ) : (
        <div className="p-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome back{session?.user?.name ? `, ${session.user.name.split(" ")[0].toLowerCase()}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here&apos;s what&apos;s happening in your workspace today.
          </p>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
