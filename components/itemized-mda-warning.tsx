// Itemized Case DO pricing with products that have no valid MDA registration:
// they won't be on the customer copy, so its total won't match the invoice.
import { AlertTriangleIcon } from "lucide-react";
import { pricedWithoutMdaMessage } from "@/lib/mda/priced-message";

export function ItemizedMdaWarning({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{pricedWithoutMdaMessage(codes)} Saving is blocked until this is resolved.</span>
    </div>
  );
}
