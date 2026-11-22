// The figures of the invoice list's stats strip for a set of invoices: the all-time cache (invoice_stats, kept by
// server/invoice.ts and by the sheet import script) and a date range on the list. No database here.
export type StatsInput = { status: string | null; grandTotal: string | null; paidAmount: string | null; soaVerified: boolean | null };

export function computeInvoiceStats(rows: StatsInput[]) {
  let totalBilled = 0, totalCollected = 0, totalOutstanding = 0;
  let draftCount = 0, sentCount = 0, paidCount = 0, overdueCount = 0, cancelledCount = 0, soaPendingCount = 0;

  for (const r of rows) {
    const gt  = parseFloat(r.grandTotal  ?? "0") || 0;
    const pa  = parseFloat(r.paidAmount  ?? "0") || 0;
    const st  = r.status ?? "draft";

    if (st !== "cancelled") totalBilled += gt;
    if (st === "paid")       { totalCollected += gt; }
    else if (st !== "cancelled") { totalCollected += pa; }
    if (st !== "paid" && st !== "cancelled") totalOutstanding += Math.max(0, gt - pa);

    if (st === "draft")     draftCount++;
    else if (st === "sent") sentCount++;
    else if (st === "paid") paidCount++;
    else if (st === "overdue") overdueCount++;
    else if (st === "cancelled") cancelledCount++;

    if (!r.soaVerified && st !== "draft" && st !== "cancelled") soaPendingCount++;
  }

  return {
    totalCount: rows.length,
    draftCount, sentCount, paidCount, overdueCount, cancelledCount,
    totalBilled:      totalBilled.toFixed(2),
    totalCollected:   totalCollected.toFixed(2),
    totalOutstanding: totalOutstanding.toFixed(2),
    soaPendingCount,
  };
}
