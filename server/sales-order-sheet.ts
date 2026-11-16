"use server";

import { requireAccess } from "@/lib/auth/require-access";
import { buildSoItemsWorkbook, type SoSheetItem } from "@/lib/sales-order/items-workbook";

// Builds the items workbook for the Sales Order create page (done on the server so the Sourcing
// column can carry an Excel dropdown/validation). Returned as base64 for the browser to save.
export async function createSoItemsSheet(
  rows: SoSheetItem[],
  opts: { withPrice: boolean; withSourcing: boolean },
): Promise<string> {
  await requireAccess("sales-order:create");
  const buf = await buildSoItemsWorkbook(rows.slice(0, 5000), opts);
  return buf.toString("base64");
}
