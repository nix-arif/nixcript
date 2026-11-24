import { cn } from "@/lib/utils";
import { soStockStage, SO_STOCK_STAGE } from "@/lib/sales-order/stock-stage";

// "Pending DO" / "Pending PR" next to a confirmed SO's status — nothing for
// any other status. See lib/sales-order/stock-stage.ts.
export function SoStockChip({ status, stockReservationStatus, className }: {
  status: string;
  stockReservationStatus: string | null | undefined;
  className?: string;
}) {
  const stage = soStockStage(status, stockReservationStatus);
  if (!stage) return null;
  const cfg = SO_STOCK_STAGE[stage];
  return (
    <span title={cfg.title} className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", cfg.className, className)}>
      {cfg.label}
    </span>
  );
}
