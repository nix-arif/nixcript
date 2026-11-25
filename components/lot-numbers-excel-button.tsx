"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLotNumberRows } from "@/server/packing-list";
import { exportLotNumbersExcel } from "@/lib/packing-list/export-lots-excel";

// Downloads the lot numbers of completed packing lists as Excel: one packing list (packingListId), this company's,
// or every company the owner holds (centralized).
export function LotNumbersExcelButton({
  packingListId, centralized = false, purchaseOrderId, purchaseOrderItemIds, fileName, showCompany = centralized, label = "Lot Numbers",
  size = "sm",
}: {
  packingListId?: string;
  purchaseOrderId?: string;
  purchaseOrderItemIds?: string[]; // only these PO lines (e.g. the lines left after filtering)
  size?: "sm" | "xs";
  centralized?: boolean;
  fileName: string;
  showCompany?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const rows = await getLotNumberRows({ packingListId, centralized, purchaseOrderId, purchaseOrderItemIds });
      if (rows.length === 0) {
        toast.info(
          packingListId ? "No lot numbers on this packing list — nothing was accepted."
          : purchaseOrderId ? `No lot numbers yet for ${purchaseOrderItemIds ? "these lines" : "this PO"} — lots are given when a packing list is completed with accepted units.`
          : "No lot numbers yet — lots are given when a packing list is completed.",
        );
        return;
      }
      exportLotNumbersExcel(rows, { fileName, showCompany });
      toast.success(`${rows.length} lot${rows.length === 1 ? "" : "s"} downloaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download the lot numbers");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" className={size === "xs" ? "h-7 gap-1.5 px-2 text-xs" : "gap-1.5"} disabled={busy} onClick={handleClick}
      title="Excel: every lot number (sheet Lots) and every sticker number (sheet Stickers)">
      <FileSpreadsheetIcon className="w-3.5 h-3.5" /> {busy ? "Preparing…" : label}
    </Button>
  );
}
