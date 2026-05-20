import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'product'
    ORDER BY ordinal_position
  `;
  console.log("DB:", process.env.DATABASE_URL?.slice(0, 50));
  cols.forEach((c: any) => console.log(`  ${c.column_name}: ${c.data_type}`));
}
run().catch(console.error);
