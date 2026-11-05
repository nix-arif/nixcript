import { cn } from "@/lib/utils";

// Loud, colour-coded tags for a packing-list line that has a problem, so such
// rows can be spotted while scrolling a long list. Renders nothing when clean.
export function LineIssueChips({ short, ret, repair }: { short: number; ret: number; repair: number }) {
  if (!(short > 0 || ret > 0 || repair > 0)) return null;
  const chip = "inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md";
  return (
    <>
      {ret > 0 && <span className={cn(chip, "bg-red-600 text-white")}>Return {ret}</span>}
      {short > 0 && <span className={cn(chip, "bg-red-600 text-white")}>Short {short}</span>}
      {repair > 0 && <span className={cn(chip, "bg-orange-500 text-white")}>Repair {repair}</span>}
    </>
  );
}
