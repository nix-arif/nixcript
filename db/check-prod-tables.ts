import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env")); // prod

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  console.log("=== Tables in prod DB ===");
  tables.forEach((t: any) => console.log(" ", t.table_name));

  // Check specifically for quotation-related tables
  const targets = ["customer", "quotation", "quotation_item", "quotation_counter"];
  console.log("\n=== Quotation/customer table check ===");
  for (const name of targets) {
    const found = tables.some((t: any) => t.table_name === name);
    console.log(`  ${found ? "✓" : "✗ MISSING"} ${name}`);
  }

  // If customer exists, check its columns
  const hasCust = tables.some((t: any) => t.table_name === "customer");
  if (hasCust) {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer'
      ORDER BY ordinal_position
    `;
    console.log("\n=== customer columns ===");
    cols.forEach((c: any) => console.log(`  ${c.column_name} (${c.data_type})`));
  }

  // If quotation_counter exists, check rows
  const hasCounter = tables.some((t: any) => t.table_name === "quotation_counter");
  if (hasCounter) {
    const rows = await sql`SELECT * FROM quotation_counter`;
    console.log("\n=== quotation_counter rows ===", rows);
  }
}

run().catch(console.error);
