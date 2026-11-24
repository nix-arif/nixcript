// One-off fill of the item-level customer trace for existing documents
// (migration drizzle/0097_item_customer_trace.sql must be applied first).
// Only fills empty fields — safe to run again.
//
//   tsx scripts/backfill-item-customers.ts          → dev database (.env.local)
//   tsx scripts/backfill-item-customers.ts --prod   → production (.env)
import { config } from "dotenv";

const prod = process.argv.includes("--prod");
config({ path: prod ? ".env" : ".env.local" });

const TABLES = [
  ["sales_order_item", "source_customer_po_id"],
  ["purchase_requisition_item", "source_customer_po_id"],
  ["purchase_order_item", "source_customer_po_id"],
  ["packing_list_item", "source_customer_po_id"],
  ["delivery_order_item", "source_customer_po_id"],
  ["invoice_item", "source_customer_po_id"],
] as const;

async function main() {
  // after dotenv: the db module reads DATABASE_URL when it loads
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { fillAllItemCustomers } = await import("@/lib/trace/item-customer");

  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@([^/]+).*$/, "$1");
  console.log(`Database: ${host}${prod ? "  (PRODUCTION)" : ""}`);

  const counts = async () => {
    const out: Record<string, string> = {};
    for (const [t, c] of TABLES) {
      const r = await db.execute(sql.raw(`SELECT COUNT(*) AS n, COUNT(${c}) AS cpo, COUNT(customer_id) AS cust, COUNT(customer_organization_id) AS org FROM ${t}`));
      const row = (r.rows ?? r)[0] as { n: string; cpo: string; cust: string; org: string };
      out[t] = `${row.n} lines · CPO id ${row.cpo} · customer id ${row.cust} · org id ${row.org}`;
    }
    return out;
  };

  const before = await counts();
  await fillAllItemCustomers();
  const after = await counts();
  for (const [t] of TABLES) console.log(`${t.padEnd(27)} before: ${before[t]}\n${"".padEnd(27)} after:  ${after[t]}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
