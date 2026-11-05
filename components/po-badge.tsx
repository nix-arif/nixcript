import { cn } from "@/lib/utils";

// PO number chip repeated on every packing-list line, tinted with the colour of
// the PO's group — so a row stays identifiable after scrolling far below its
// group header. `color` is one entry of the pages' PO_COLORS palette.
export function PoBadge({ label, color, className }: { label: string; color: { header: string; border: string }; className?: string }) {
  return (
    <span
      title={label}
      className={cn(
        "inline-block max-w-full truncate align-middle font-mono text-[10px] font-medium text-foreground/80 px-1.5 py-0.5 rounded-md border whitespace-nowrap",
        color.header,
        color.border,
        className,
      )}
    >
      {label}
    </span>
  );
}
