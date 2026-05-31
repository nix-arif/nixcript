import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const statements = [
    `DROP TABLE IF EXISTS claim_mileage_item CASCADE`,
    `CREATE TABLE IF NOT EXISTS claim_line_item (
      id text PRIMARY KEY NOT NULL,
      application_id text NOT NULL REFERENCES claim_application(id) ON DELETE CASCADE,
      organization_id text NOT NULL,
      category text NOT NULL,
      line_date text NOT NULL,
      description text,
      from_location text,
      to_location text,
      distance_km text,
      rate_per_unit text,
      venue text,
      destination text,
      currency text,
      amount_foreign text,
      exchange_rate text,
      amount_myr text NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS claim_line_item_app_idx ON claim_line_item (application_id)`,
    `CREATE INDEX IF NOT EXISTS claim_line_item_org_idx ON claim_line_item (organization_id)`,
    `CREATE TABLE IF NOT EXISTS claim_entertainment_detail (
      id text PRIMARY KEY NOT NULL,
      application_id text NOT NULL UNIQUE REFERENCES claim_application(id) ON DELETE CASCADE,
      organization_id text NOT NULL,
      event_date text NOT NULL,
      restaurant_name text NOT NULL,
      customer_name text NOT NULL,
      department_organization text NOT NULL,
      purpose text NOT NULL,
      amount text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`,
  ];

  for (const stmt of statements) {
    await sql.query(stmt);
    console.log("✓", stmt.slice(0, 60).replace(/\s+/g, " ").trim());
  }
  console.log("[✓] All done");
}

main().catch(console.error);
