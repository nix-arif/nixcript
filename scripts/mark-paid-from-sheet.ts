/**
 * Marks as paid the invoices the Case Detail sheet says are Paid but the system still has as sent or
 * overdue — as the app's "Mark as paid" does (server/invoice.ts markInvoicePaid): status paid, the
 * paid amount = the invoice total, with the sheet's payment date and payment reference. Nothing else
 * is changed (a cancelled or draft invoice is left alone, and reported). The invoice list's summary
 * figures are refreshed after.
 *
 *   npx dotenv-cli -e .env -- npx tsx scripts/mark-paid-from-sheet.ts            # dry run
 *   npx dotenv-cli -e .env -- npx tsx scripts/mark-paid-from-sheet.ts --apply
 */

import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { ORG, ALL_ORG_IDS, resolveOrgId, str, toDate, mapStatus } from "./seed-config";
import { sheetRows } from "./case-sheet";
import { computeInvoiceStats } from "../lib/invoice/stats";

const apply = process.argv.includes("--apply");
const orgOf = (company: unknown, invoiceNo: string) =>
  resolveOrgId(company) ?? (/^INVAF\//i.test(invoiceNo) ? ORG.affirma : /^INVSI\//i.test(invoiceNo) ? ORG.innosys : null);

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const orgIds = [...ALL_ORG_IDS] as string[];
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLY" : "dry run — nothing is written"})`);

  // the sheet's Paid invoices (first row of an invoice number, as the sync)
  const paid = new Map<string, Record<string, string>>();
  for (const r of await sheetRows()) {
    const no = str(r["INVOICE NO"]);
    if (!no) continue;
    const orgId = orgOf(r["COMPANY"], no);
    if (!orgId) continue;
    const key = `${orgId}|${no}`;
    if (!paid.has(key) && mapStatus(str(r["STATUS"]) ?? "") === "paid") paid.set(key, r);
  }

  const invs = await sql`select id, organization_id, invoice_no, status, grand_total, paid_at, payment_ref from invoice where organization_id = any(${orgIds})`;
  const todo: { id: string; no: string; total: string; paidAt: Date | null; ref: string | null; line: string }[] = [];
  const skipped: string[] = [];
  for (const inv of invs as any[]) {
    const r = paid.get(`${inv.organization_id}|${inv.invoice_no}`);
    if (!r || inv.status === "paid") continue;
    if (inv.status !== "sent" && inv.status !== "overdue") { skipped.push(`${inv.invoice_no}: is ${inv.status} in the system (Paid on the sheet) — left as it is`); continue; }
    const paidAt = toDate(r["PAYMENT DATE"]) ?? null;
    const ref = str(r["PAYMENT REF"]) ?? inv.payment_ref ?? null;
    todo.push({
      id: inv.id, no: inv.invoice_no, total: inv.grand_total, paidAt, ref,
      line: `${inv.invoice_no}: ${inv.status} → paid · RM ${Number(inv.grand_total).toFixed(2)} · paid ${paidAt ? paidAt.toLocaleDateString("en-MY") : "(no payment date on the sheet)"}${ref ? ` · ref ${ref}` : ""}`,
    });
  }

  console.log(`\n${apply ? "Marked" : "Would mark"} ${todo.length} invoices paid:`);
  for (const t of todo) console.log("  " + t.line);
  if (skipped.length) { console.log(`\nLeft alone (${skipped.length}):`); for (const s of skipped) console.log("  " + s); }
  if (!apply || todo.length === 0) return;

  for (const t of todo)
    await sql`update invoice set status = 'paid', paid_amount = ${t.total}, paid_at = ${t.paidAt}, payment_ref = ${t.ref}, updated_at = now()
      where id = ${t.id} and status in ('sent', 'overdue')`;

  // the invoice list's summary figures (invoice_stats), as server/invoice.ts refreshInvoiceStats
  for (const orgId of orgIds) {
    const rows = await sql`select status, grand_total, paid_amount, soa_verified from invoice where organization_id = ${orgId}`;
    const s = computeInvoiceStats(rows.map((r: any) => ({ status: r.status, grandTotal: r.grand_total, paidAmount: r.paid_amount, soaVerified: r.soa_verified })));
    await sql`insert into invoice_stats (id, organization_id, total_count, draft_count, sent_count, paid_count, overdue_count, cancelled_count, total_billed, total_collected, total_outstanding, soa_pending_count, updated_at)
      values (${nanoid()}, ${orgId}, ${s.totalCount}, ${s.draftCount}, ${s.sentCount}, ${s.paidCount}, ${s.overdueCount}, ${s.cancelledCount}, ${s.totalBilled}, ${s.totalCollected}, ${s.totalOutstanding}, ${s.soaPendingCount}, now())
      on conflict (organization_id) do update set total_count = excluded.total_count, draft_count = excluded.draft_count, sent_count = excluded.sent_count,
        paid_count = excluded.paid_count, overdue_count = excluded.overdue_count, cancelled_count = excluded.cancelled_count, total_billed = excluded.total_billed,
        total_collected = excluded.total_collected, total_outstanding = excluded.total_outstanding, soa_pending_count = excluded.soa_pending_count, updated_at = now()`;
  }
  console.log("✓ refreshed the invoice summary figures");
}

main().then(() => process.exit(0), (e) => { console.error("FAILED:", e); process.exit(1); });
