import React from "react";
import { SearchParams } from "next/dist/server/request/search-params";
import { ShieldOffIcon } from "lucide-react";
import { ensureProfileExists } from "@/server/profile";
import { getCurrentUser } from "@/server/users";

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) => {
  const params = await searchParams;
  const [session] = await Promise.all([getCurrentUser(), ensureProfileExists()]);

  return (
    <div className="flex flex-col gap-6">
      {params.error === "forbidden" && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <ShieldOffIcon className="w-4 h-4 mt-0.5 shrink-0" />
          You don&apos;t have permission to access that page.
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening in your workspace today.
        </p>
      </div>

      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
      </div>
      <div className="min-h-[40vh] flex-1 rounded-xl bg-muted/50" />
    </div>
  );
};

export default DashboardPage;
