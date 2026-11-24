import { cn } from "@/lib/utils";
import { soStockStage, SO_STOCK_STAGE, isUnsubmittedSo, SO_DRAFT_TAG } from "@/lib/sales-order/stock-stage";

// The tag next to an SO's status: "Draft" while a pending-do / pending-pr SO
// hasn't been submitted, "Pending DO" / "Pending PR" once it's confirmed,
// nothing otherwise. See lib/sales-order/stock-stage.ts.
export function SoStockChip({ status, stockReservationStatus, className }: {
  status: string;
  stockReservationStatus: string | null | undefined;
  className?: string;
}) {
  const stage = soStockStage(status, stockReservationStatus);
  const cfg = stage ? SO_STOCK_STAGE[stage] : isUnsubmittedSo(status) ? SO_DRAFT_TAG : null;
  if (!cfg) return null;
  return (
    <span title={cfg.title} className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", cfg.className, className)}>
      {cfg.label}
    </span>
  );
}
