import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

const tables = [
  "claim_entertainment_detail",
  "claim_document",
  "claim_line_item",
  "claim_application",
  "claim_type",
];

async function main() {
  for (const table of tables) {
    await sql.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    console.log(`Dropped: ${table}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
