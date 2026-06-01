import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Add hotel_cap_per_night to claim_type
  await sql`
    ALTER TABLE claim_type
    ADD COLUMN IF NOT EXISTS hotel_cap_per_night text
  `;
  console.log("Added: claim_type.hotel_cap_per_night");

  // Add line_item_id to claim_document (from previous session)
  await sql`
    ALTER TABLE claim_document
    ADD COLUMN IF NOT EXISTS line_item_id text
      REFERENCES claim_line_item(id) ON DELETE SET NULL
  `;
  console.log("Added: claim_document.line_item_id");

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
