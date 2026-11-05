import { cn } from "@/lib/utils";
import type { LineReplacement } from "@/server/packing-list";

// Marks a packing-list line that was sent to make good earlier rejected units,
// so the line carries its own history: what it replaces, where that came from
// and how each attempt turned out. Renders nothing for an ordinary line.
export function ReplacementChips({ replacements }: { replacements: LineReplacement[] }) {
  if (replacements.length === 0) return null;
  const total = replacements.reduce((s, r) => s + r.qtyAllocated, 0);
  return (
    <div className="mb-1 space-y-0.5">
      <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-sky-600 text-white">
        Replacement {total}
      </span>
      {replacements.map((r) => {
        const outcome =
          r.status !== "inspected" ? "awaiting inspection"
          : (r.qtyFailed ?? 0) > 0 ? `${r.qtyGood} good · ${r.qtyFailed} failed`
          : `${r.qtyGood} good`;
        return (
          <p
            key={r.attemptId}
            title={r.returnReason ? `Reason it was rejected: ${r.returnReason}` : undefined}
            className="text-[10px] leading-snug text-sky-800 dark:text-sky-300"
          >
            Attempt {r.attemptNo}: {r.qtyAllocated} for {r.returnedQty} rejected on {r.returnGrNo}
            {r.sourcePackingListNo && <> (from {r.sourcePackingListNo})</>}
            {r.returnPoNo && <> · {r.returnPoNo}</>}
            {" — "}
            <span className={cn("font-medium", (r.qtyFailed ?? 0) > 0 && "text-red-600 dark:text-red-400")}>{outcome}</span>
          </p>
        );
      })}
    </div>
  );
}
