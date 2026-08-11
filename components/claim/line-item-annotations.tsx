import { PencilIcon, XIcon } from "lucide-react";

function fmtDate(v: string | Date | null): string | null {
  if (!v) return null;
  return new Date(v).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmount(v: string): string {
  return `RM ${parseFloat(v).toFixed(2)}`;
}

// Amber "checker edited this line" tag — shown alongside the current (already-corrected) value.
export function EditBadge({
  editedByName,
  editedAt,
  editReason,
  amountChange,
  descriptionChange,
}: {
  editedByName: string | null;
  editedAt: string | Date | null;
  editReason: string | null;
  amountChange?: { from: string; to: string } | null;
  descriptionChange?: { from: string | null; to: string | null } | null;
}) {
  const at = fmtDate(editedAt);
  return (
    <span className="inline-flex items-start gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
      <PencilIcon className="w-3 h-3 shrink-0 mt-0.5" />
      <span>
        {editedByName ?? "Checker"} edited{at ? ` · ${at}` : ""}
        {amountChange && (
          <>
            {" — "}
            <span className="line-through opacity-70">{fmtAmount(amountChange.from)}</span>
            {" → "}
            <span className="font-semibold">{fmtAmount(amountChange.to)}</span>
          </>
        )}
        {descriptionChange && (
          <>
            {" — "}
            <span className="line-through opacity-70">{descriptionChange.from || "—"}</span>
            {" → "}
            <span className="font-semibold">{descriptionChange.to || "—"}</span>
          </>
        )}
        {editReason && <span className="block italic opacity-80 mt-0.5">&ldquo;{editReason}&rdquo;</span>}
      </span>
    </span>
  );
}

// Red "checker slashed this line" tag — rendered outside any line-through wrapper so it stays legible.
export function SlashBadge({
  slashedByName,
  slashedAt,
  slashReason,
}: {
  slashedByName: string | null;
  slashedAt: string | Date | null;
  slashReason: string | null;
}) {
  const at = fmtDate(slashedAt);
  return (
    <span className="inline-flex items-start gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
      <XIcon className="w-3 h-3 shrink-0 mt-0.5" />
      <span>
        Slashed{slashedByName ? ` by ${slashedByName}` : ""}
        {at ? ` · ${at}` : ""}
        {slashReason && <span className="block italic opacity-80 mt-0.5">&ldquo;{slashReason}&rdquo;</span>}
      </span>
    </span>
  );
}
