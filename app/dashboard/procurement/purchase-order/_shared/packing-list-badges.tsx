import Link from "next/link";
import { PackageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PoPackingList = { id: string; packingListNo: string; supplierRefNo: string | null; status: string };

/**
 * Packing lists raised for a PO, shown on the supplier PO list cards. Shows our
 * packing list no. with the supplier's own ref beside it, and links to the
 * packing list. `basePath` is the packing list route to open (regular or centralized).
 */
export function PackingListBadges({ lists, basePath, highlight }: {
  lists: PoPackingList[];
  basePath: string;
  highlight?: (text: string) => React.ReactNode;
}) {
  if (lists.length === 0) return null;
  const hl = highlight ?? ((t: string) => t);
  return (
    <>
      {lists.map((pl) => (
        <Link
          key={pl.id}
          href={`${basePath}/${pl.id}`}
          onClick={(e) => e.stopPropagation()}
          title={`Packing list ${pl.packingListNo}${pl.supplierRefNo ? ` · supplier ref ${pl.supplierRefNo}` : ""} (${pl.status})`}
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md border hover:underline",
            pl.status === "completed"
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
              : "bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
          )}
        >
          <PackageIcon className="w-2.5 h-2.5 shrink-0" />
          {hl(pl.packingListNo)}
          {pl.supplierRefNo && <span className="text-muted-foreground">· {hl(pl.supplierRefNo)}</span>}
        </Link>
      ))}
    </>
  );
}
