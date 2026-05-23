import { Skeleton } from "@/components/ui/skeleton";

const ROW_WIDTHS: [string, string, string, string][] = [
  ["w-36", "w-48", "w-20", "w-16"],
  ["w-44", "w-32", "w-24", "w-20"],
  ["w-28", "w-56", "w-16", "w-24"],
  ["w-40", "w-40", "w-28", "w-12"],
  ["w-32", "w-52", "w-20", "w-20"],
  ["w-48", "w-36", "w-24", "w-16"],
  ["w-24", "w-44", "w-16", "w-24"],
];

export function DashboardLoadingSkeleton() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      <div className="flex gap-2">
        {["w-20", "w-24", "w-20", "w-16"].map((w, i) => (
          <Skeleton key={i} className={`h-6 ${w} rounded-full`} />
        ))}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-4 gap-6 px-4 py-3 bg-muted/40 border-b border-border">
          {["w-20", "w-28", "w-16", "w-10"].map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
        {ROW_WIDTHS.map((cols, rowIdx) => (
          <div
            key={rowIdx}
            className="grid grid-cols-4 gap-6 px-4 py-3.5 border-b border-border last:border-b-0"
          >
            {cols.map((w, colIdx) => (
              <Skeleton key={colIdx} className={`h-3.5 ${w}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
