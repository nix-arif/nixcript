import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    ORDER BY tablename
  `;
  console.log("DB tables:\n" + rows.map((r: {tablename: string}) => "  " + r.tablename).join("\n"));
}
main().catch(console.error);
