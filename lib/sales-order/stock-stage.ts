// Where a confirmed Sales Order stands on stock — shown next to its
// "Confirmed" status. Decided when it's approved (stock reserved or not, see
// server/stock-reservation.ts#performStockCheckAndReserve) and updated by
// "Re-check stock":
//   reserved      → "Pending DO" — the stock is held, ready to deliver
//   insufficient  → "Pending PR" — something is short, needs purchasing
// Before approval an SO is a draft (or submitted) and has no stock stage.

export type SoStockStage = "pending-do" | "pending-pr";

export function soStockStage(status: string, stockReservationStatus: string | null | undefined): SoStockStage | null {
  if (status !== "confirmed") return null;
  if (stockReservationStatus === "reserved") return "pending-do";
  if (stockReservationStatus === "insufficient") return "pending-pr";
  return null;
}

export const SO_STOCK_STAGE: Record<SoStockStage, { label: string; className: string; title: string }> = {
  "pending-do": {
    label: "Pending DO",
    className: "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400",
    title: "Approved and stock is reserved — ready for a delivery order",
  },
  "pending-pr": {
    label: "Pending PR",
    className: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400",
    title: "Approved but stock is short — needs a purchase requisition",
  },
};
