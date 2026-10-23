import { AlertCircleIcon, ClipboardListIcon, EyeIcon, PackageIcon, TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const chip = "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border shrink-0";

function Item({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      {children}
      {label}
    </span>
  );
}

/** Key to the badges on the supplier PO list cards. */
export function PoLegend({ centralized }: { centralized?: boolean }) {
  return (
    <div className="mb-3 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-border rounded-lg bg-muted/5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">Legend</span>

      <Item label="all received">
        <span className={cn(chip, "font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800")}>100% received</span>
      </Item>
      <Item label="partly received">
        <span className={cn(chip, "font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800")}>40% received</span>
      </Item>
      <Item label="nothing received yet">
        <span className={cn(chip, "font-medium bg-muted/40 text-muted-foreground border-border/60")}>0% received</span>
      </Item>

      <Item label="packing list pending (no. · supplier's ref)">
        <span className={cn(chip, "font-mono bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800")}>
          <PackageIcon className="w-2.5 h-2.5" />PL-0001
        </span>
      </Item>
      <Item label="packing list completed">
        <span className={cn(chip, "font-mono bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800")}>
          <PackageIcon className="w-2.5 h-2.5" />PL-0001
        </span>
      </Item>

      <Item label="received qty awaiting return / repair">
        <span className={cn(chip, "font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800")}>
          <AlertCircleIcon className="w-2.5 h-2.5" />2 pending return
        </span>
      </Item>

      <Item label="purchase requisition">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 font-mono">
          <ClipboardListIcon className="w-2.5 h-2.5" />PR-0001
        </span>
      </Item>
      <Item label="customer PO">
        <span className={cn(chip, "font-mono font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800")}>CPO-0001</span>
      </Item>
      <Item label="customer (hospital, name)">
        <span className="inline-flex items-center gap-1">
          <span className={cn(chip, "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800")}>Hospital</span>
          <span className={cn(chip, "bg-muted text-muted-foreground border-border/60")}>Name</span>
        </span>
      </Item>
      <Item label="set title (in customer order)">
        <span className={cn(chip, "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800")}>
          <TagIcon className="w-2.5 h-2.5" />Set name
        </span>
      </Item>

      {centralized && (
        <>
          <Item label="organization">
            <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded px-1.5 py-0.5">Org</span>
          </Item>
          <Item label="no edit rights">
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
              <EyeIcon className="w-2.5 h-2.5" />View only
            </span>
          </Item>
        </>
      )}
    </div>
  );
}
