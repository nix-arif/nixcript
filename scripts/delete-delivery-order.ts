/**
 * Delete one delivery order by id, putting back any stock it still has out —
 * the same rules as deleteDeliveryOrder()/restoreDoStock() in
 * server/delivery-order.ts, for cases the UI can't (or shouldn't) do.
 *
 *  - Nets every movement recorded against the DO (CASE_USE / LOAN_OUT /
 *    STOCK_OUT and any RETURN / LOAN_RETURN) per org + product + warehouse,
 *    across ALL companies — a Case DO can take a sibling company's stock —
 *    and returns only what's still outstanding, into that same org/bucket.
 *  - Refuses when an invoice references the DO, or when a line is
 *    serial-tracked (asset units need their status restored by hand).
 *  - Stock return + DO delete run in ONE transaction.
 *
 * Dry run (default):
 *   npx dotenv -e .env.local -- npx tsx scripts/delete-delivery-order.ts --id <doId>
 * Apply:
 *   npx dotenv -e .env.local -- npx tsx scripts/delete-delivery-order.ts --id <doId> --apply
 * (-e .env for production — back it up first)
 */
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const id = arg("id");
  const apply = process.argv.includes("--apply");
  if (!id) throw new Error("Usage: --id <deliveryOrderId> [--apply]");

  const sql = neon(process.env.DATABASE_URL!);
  console.log(`Database: ${new URL(process.env.DATABASE_URL!).host.replace(/-pooler/, "")}   Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const [d] = await sql`
    SELECT d.id, d.do_no, d.status, d.is_case_do, d.created_by, o.name AS company
    FROM delivery_order d JOIN organization o ON o.id = d.organization_id WHERE d.id = ${id}`;
  if (!d) throw new Error(`DO ${id} not found`);
  console.log(`DO ${d.do_no} — ${d.company}, ${d.status}${d.is_case_do ? ", Case DO" : ""}`);

  const [inv] = await sql`SELECT invoice_no FROM invoice WHERE delivery_order_id = ${id} LIMIT 1`;
  if (inv) throw new Error(`Refusing: invoice ${inv.invoice_no} is linked to this DO`);
  const [unitLine] = await sql`SELECT product_code FROM delivery_order_item WHERE delivery_order_id = ${id} AND unit_id IS NOT NULL LIMIT 1`;
  if (unitLine) throw new Error(`Refusing: serial-tracked line (${unitLine.product_code}) — restore its asset unit by hand`);

  const moves = await sql`
    SELECT organization_id, product_id, product_code, warehouse_label, quantity::numeric AS qty
    FROM stock_movement
    WHERE reference_id = ${id}
      AND movement_type IN ('STOCK_OUT','CASE_USE','LOAN_OUT','RETURN','LOAN_RETURN')`;
  const net = new Map<string, { org: string; productId: string; code: string; label: string; qty: number }>();
  for (const m of moves) {
    const k = `${m.organization_id}::${m.product_id}::${m.warehouse_label}`;
    const e = net.get(k) ?? { org: m.organization_id, productId: m.product_id, code: m.product_code, label: m.warehouse_label, qty: 0 };
    e.qty += Number(m.qty);
    net.set(k, e);
  }
  const toReturn = [...net.values()].filter((e) => e.qty < 0);

  const orgNames = new Map((await sql`SELECT id, name FROM organization`).map((o) => [o.id, o.name]));
  console.log("\nPlan:");
  if (toReturn.length === 0) console.log("  • no stock outstanding — nothing to return");
  const queries = [];
  const now = new Date().toISOString();
  for (const e of toReturn) {
    const back = Math.abs(e.qty);
    const [lvl] = await sql`
      SELECT id, quantity::numeric AS q FROM stock_level
      WHERE organization_id = ${e.org} AND product_id = ${e.productId} AND warehouse_label = ${e.label}`;
    const before = lvl ? Number(lvl.q) : 0;
    const after = before + back;
    console.log(`  • return ${back} × ${e.code} → ${orgNames.get(e.org)} / ${e.label}   (${before} → ${after})`);
    queries.push(lvl
      ? sql`UPDATE stock_level SET quantity = ${after.toFixed(4)}, updated_at = ${now} WHERE id = ${lvl.id}`
      : sql`INSERT INTO stock_level (id, organization_id, product_id, warehouse_label, quantity, reserved_qty, updated_at)
            VALUES (${nanoid()}, ${e.org}, ${e.productId}, ${e.label}, ${after.toFixed(4)}, '0', ${now})`);
    queries.push(sql`
      INSERT INTO stock_movement (id, organization_id, product_id, product_code, warehouse_label, movement_type, quantity, balance_after,
        reference_type, reference_id, reference_no, notes, status, reviewed_by, reviewed_at, created_by, created_at)
      VALUES (${nanoid()}, ${e.org}, ${e.productId}, ${e.code}, ${e.label}, 'RETURN', ${back.toFixed(4)}, ${after.toFixed(4)},
        'DELIVERY_ORDER', ${id}, ${d.do_no}, ${`DO deleted — stock returned: ${e.code}`}, 'APPROVED', ${d.created_by}, ${now}, ${d.created_by}, ${now})`);
  }
  console.log(`  • delete DO ${d.do_no} (${d.company}) and its lines`);
  queries.push(sql`DELETE FROM delivery_order WHERE id = ${id}`);

  if (!apply) { console.log("\nDry run only — re-run with --apply."); return; }
  await sql.transaction(queries);
  const [still] = await sql`SELECT id FROM delivery_order WHERE id = ${id}`;
  console.log(`\n✓ Applied. DO still exists: ${still ? "YES (unexpected!)" : "no"}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
