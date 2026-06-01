import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT key FROM permission ORDER BY key`;
  for (const row of rows) console.log(row.key);
}
main();
