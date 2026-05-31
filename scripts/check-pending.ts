import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Check if number_format column exists on document_numbering_setting
  const cols = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'document_numbering_setting'
    ORDER BY ordinal_position
  `;
  console.log("document_numbering_setting columns:");
  for (const c of cols) console.log(" ", c.column_name, c.data_type, c.column_default ?? "");

  // Check all columns of new claim tables
  const liCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='claim_line_item' ORDER BY ordinal_position`;
  console.log("\nclaim_line_item columns:", liCols.map((r: {column_name: string}) => r.column_name).join(", "));

  const edCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='claim_entertainment_detail' ORDER BY ordinal_position`;
  console.log("claim_entertainment_detail columns:", edCols.map((r: {column_name: string}) => r.column_name).join(", "));
}
main().catch(console.error);
