import React from "react";
import { SearchParams } from "next/dist/server/request/search-params";
import { ShieldOffIcon } from "lucide-react";

const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) => {
  const params = await searchParams;
  return (
    <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min">
      {params.error === "forbidden" && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <ShieldOffIcon className="w-4 h-4 mt-0.5 shrink-0" />
          You don't have permission to access that page.
        </div>
      )}
      Dashboard
    </div>
  );
};

export default DashboardPage;
