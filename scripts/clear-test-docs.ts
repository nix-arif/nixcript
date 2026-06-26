/**
 * Delete a Sales Order and all documents that were created from it.
 *
 * What gets deleted when you delete an SO:
 *   SO → invoice (+ invoice_item, invoice_expense, caseCommission)
 *      → delivery_order (+ delivery_order_item)
 *      → purchase_order (+ purchase_order_item, goods_receipt, goods_receipt_item)
 *      → purchase_requisition (+ purchase_requisition_item)
 *      → sales_order_item  ← cascades automatically
 *
 * CPO is NOT deleted — it is the parent that triggered the SO, not a child.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/clear-test-docs.ts <SO_NUMBER>
 *
 * Example:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/clear-test-docs.ts BMS-SO-2025-0001
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  salesOrder,
  purchaseRequisition,
  purchaseOrder,
  deliveryOrder,
  invoice,
  caseCommission,
} from "../db/schema";

const soNo = process.argv[2];
if (!soNo) {
  console.error("Usage: npx tsx scripts/clear-test-docs.ts <SO_NUMBER>");
  console.error("Example: npx tsx scripts/clear-test-docs.ts BMS-SO-2025-0001");
  process.exit(1);
}

async function deleteSo(soNo: string) {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // ── Find the SO ───────────────────────────────────────────────────────────────
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(eq(salesOrder.soNo, soNo))
    .limit(1);

  if (!so) {
    console.error(`SO not found: ${soNo}`);
    process.exit(1);
  }

  console.log(`Deleting SO: ${so.soNo} (${so.id})`);
  console.log("─".repeat(50));

  const soId = so.id;

  // ── Delivery Orders (find first — needed for invoice lookup below) ────────────
  const doIds = (await db
    .select({ id: deliveryOrder.id })
    .from(deliveryOrder)
    .where(eq(deliveryOrder.salesOrderId, soId))
  ).map((r) => r.id);

  // ── Invoice ───────────────────────────────────────────────────────────────────
  // Invoices may reference the SO directly (salesOrderId) OR only via a DO
  // (deliveryOrderId). Collect both to avoid orphaned invoices.
  // caseCommission has no cascade from invoice → delete first.
  // invoice → cascades invoice_item, invoice_expense automatically.
  const invRows = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(
      doIds.length > 0
        ? or(eq(invoice.salesOrderId, soId), inArray(invoice.deliveryOrderId, doIds))
        : eq(invoice.salesOrderId, soId),
    );
  const invIds = invRows.map((r) => r.id);

  if (invIds.length > 0) {
    await db.delete(caseCommission).where(inArray(caseCommission.invoiceId, invIds));
    await db.delete(invoice).where(inArray(invoice.id, invIds));
    console.log(`✓ ${invIds.length} invoice(s) deleted`);
  } else {
    console.log("  no invoices");
  }

  // ── Delivery Order ────────────────────────────────────────────────────────────
  // delivery_order_item cascades automatically
  if (doIds.length > 0) {
    await db.delete(deliveryOrder).where(inArray(deliveryOrder.id, doIds));
  }
  console.log(`✓ ${doIds.length} delivery order(s) deleted`);

  // ── Purchase Order ────────────────────────────────────────────────────────────
  // Cascades: purchase_order_item, purchase_order_customer_po,
  //           goods_receipt, goods_receipt_item
  const poResult = await db
    .delete(purchaseOrder)
    .where(eq(purchaseOrder.salesOrderId, soId));
  console.log(`✓ ${poResult.rowCount ?? "?"} purchase order(s) deleted (GRs cascade)`);

  // ── Purchase Requisition ──────────────────────────────────────────────────────
  // purchase_requisition_item cascades automatically
  const prResult = await db
    .delete(purchaseRequisition)
    .where(eq(purchaseRequisition.salesOrderId, soId));
  console.log(`✓ ${prResult.rowCount ?? "?"} purchase requisition(s) deleted`);

  // ── Sales Order ───────────────────────────────────────────────────────────────
  // Break self-reference before deleting (pro-forma / replacement SOs)
  await db.execute(
    sql`UPDATE sales_order SET original_so_id = NULL WHERE original_so_id = ${soId}`,
  );
  // Break the circular FK both ways before deleting
  await db.execute(sql`UPDATE sales_order SET customer_po_id = NULL WHERE id = ${soId}`);
  await db.execute(sql`UPDATE customer_purchase_order SET sales_order_id = NULL WHERE sales_order_id = ${soId}`);
  // sales_order_item cascades automatically
  await db.delete(salesOrder).where(eq(salesOrder.id, soId));
  console.log(`✓ Sales Order ${soNo} deleted`);

  console.log("─".repeat(50));
  console.log("✅ Done.");
  process.exit(0);
}

deleteSo(soNo).catch((err) => {
  console.error(err);
  process.exit(1);
});
